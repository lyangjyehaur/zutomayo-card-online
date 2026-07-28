import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEffect } from '../src/game/effects/parser';
import type { CardDef } from '../src/game/types';

export const REVIEWED_UNLISTED_SOURCE_NOTE = 'reviewed-unlisted-release:v1';
export const REVIEWED_UNLISTED_CARD_IDS = ['4th_105', '4th_106', '4th_107'] as const;
export const REVIEWED_UNLISTED_LANGS = ['zh-TW', 'zh-CN', 'zh-HK', 'ko'] as const;

type ReviewedLang = (typeof REVIEWED_UNLISTED_LANGS)[number];

type SourceCard = {
  candidateId: string;
  expectedCardId: string;
  catalogStatus: string;
  distributionType: string;
  sourcePageUrl: string;
  sourceSha256: string;
};

type SourcesFile = { cards: SourceCard[] };

type HumanReview = {
  cardId: string;
  nameJa: string;
  nameEnOfficial: string;
  effectJa: string;
  effectEnOfficial: string;
  playStatus: string;
  playStatusReason: string;
  type: string;
  rarity: string;
  element: string;
  clock: string;
  powerCost: string;
  sendToPower: string;
  attackNight: string;
  attackDay: string;
  song: string;
  illustrator: string;
  pack: string;
  imageReviewStatus: string;
  textReviewStatus: string;
  reviewedAt: string;
};

type HumanReviewsFile = { reviews: Record<string, HumanReview> };

export type ReleaseTranslation = { name: string; effect: string };

type ReleaseCard = {
  cardId: string;
  imageUrl: string;
  catalogStatus: string;
  distributionType: string;
  publicationStatus: string;
  playStatus: string;
  translations: Record<ReviewedLang, ReleaseTranslation>;
};

export type ReviewedUnlistedReleaseManifest = {
  schemaVersion: number;
  reviewedAt: string;
  reviewStatus: string;
  cards: ReleaseCard[];
};

export type ReviewedUnlistedCard = CardDef & {
  sourceUrl: string;
  sourceNote: typeof REVIEWED_UNLISTED_SOURCE_NOTE;
  sourceSha256: string;
  translations: Record<ReviewedLang, ReleaseTranslation>;
  reviewedAt: string;
};

export type ReviewedUnlistedRelease = {
  cards: ReviewedUnlistedCard[];
  sourceSha256: string;
  reviewedAt: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const HTTPS_R2 = /^https:\/\/r2\.dan\.tw\/cards\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.jpg$/;
const SUPPORTED_RELEASE_ACTIONS = new Set(['requestChoice', 'clockAdvance', 'moveOpponentAreaEnchant']);
const ELEMENTS = new Set(['闇', '炎', '電気', '風', 'カオス']);
const CARD_TYPES = new Set(['Character', 'Enchant', 'Area Enchant']);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function integer(value: string, field: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${field} must be an integer >= ${minimum}`);
  return parsed;
}

function optionalAttack(value: string, field: string): number | null {
  if (value === '') return null;
  return integer(value, field);
}

function assertExactIds(label: string, ids: string[]): void {
  const expected = [...REVIEWED_UNLISTED_CARD_IDS].sort();
  const actual = [...ids].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertNonempty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be nonempty`);
}

export function buildReviewedUnlistedRelease(
  sources: SourcesFile,
  reviews: HumanReviewsFile,
  manifest: ReviewedUnlistedReleaseManifest,
): ReviewedUnlistedRelease {
  if (manifest.schemaVersion !== 1) throw new Error('release manifest schemaVersion must be 1');
  if (manifest.reviewStatus !== 'verified') throw new Error('release manifest reviewStatus must be verified');
  if (!Number.isFinite(Date.parse(manifest.reviewedAt)))
    throw new Error('release manifest reviewedAt must be an ISO date');

  const relevantSources = sources.cards.filter((card) =>
    (REVIEWED_UNLISTED_CARD_IDS as readonly string[]).includes(card.candidateId),
  );
  assertExactIds(
    'source file',
    relevantSources.map((card) => card.candidateId),
  );
  assertExactIds(
    'human review file',
    Object.keys(reviews.reviews).filter((cardId) => (REVIEWED_UNLISTED_CARD_IDS as readonly string[]).includes(cardId)),
  );
  assertExactIds(
    'release manifest',
    manifest.cards.map((card) => card.cardId),
  );

  const sourceById = new Map(relevantSources.map((card) => [card.candidateId, card]));
  const releaseById = new Map(manifest.cards.map((card) => [card.cardId, card]));
  const cards = REVIEWED_UNLISTED_CARD_IDS.map((cardId): ReviewedUnlistedCard => {
    const source = sourceById.get(cardId);
    const review = reviews.reviews[cardId];
    const release = releaseById.get(cardId);
    if (!source || !review || !release) throw new Error(`${cardId}: incomplete reviewed release input`);
    if (source.expectedCardId !== cardId || review.cardId !== cardId) throw new Error(`${cardId}: card IDs disagree`);
    if (!SHA256.test(source.sourceSha256)) throw new Error(`${cardId}: invalid source SHA-256`);
    if (!source.sourcePageUrl.startsWith('https://')) throw new Error(`${cardId}: source page must use HTTPS`);
    if (!HTTPS_R2.test(release.imageUrl)) throw new Error(`${cardId}: image must be a canonical R2 JPEG URL`);
    if (review.textReviewStatus !== 'verified' || review.imageReviewStatus !== 'approved') {
      throw new Error(`${cardId}: text and image reviews must be approved`);
    }
    if (review.playStatus !== 'playable' || release.playStatus !== 'playable') {
      throw new Error(`${cardId}: release card must be playable`);
    }
    if (release.publicationStatus !== 'published') throw new Error(`${cardId}: release card must be published`);
    if (release.catalogStatus !== source.catalogStatus || release.distributionType !== source.distributionType) {
      throw new Error(`${cardId}: release catalog metadata differs from reviewed source`);
    }
    if (!CARD_TYPES.has(review.type)) throw new Error(`${cardId}: unsupported card type ${review.type}`);
    if (!ELEMENTS.has(review.element)) throw new Error(`${cardId}: unsupported element ${review.element}`);
    for (const field of ['nameJa', 'nameEnOfficial', 'effectJa', 'effectEnOfficial', 'pack', 'illustrator'] as const) {
      assertNonempty(review[field], `${cardId}.${field}`);
    }
    if (!Number.isFinite(Date.parse(review.reviewedAt))) throw new Error(`${cardId}: invalid human review date`);

    const parsed = parseEffect(review.effectJa);
    if (!parsed) throw new Error(`${cardId}: reviewed effect does not parse`);
    if (!SUPPORTED_RELEASE_ACTIONS.has(parsed.action.type)) {
      throw new Error(`${cardId}: parsed action ${parsed.action.type} has no approved release executor`);
    }
    for (const lang of REVIEWED_UNLISTED_LANGS) {
      const translation = release.translations?.[lang];
      if (!translation) throw new Error(`${cardId}/${lang}: missing reviewed translation`);
      assertNonempty(translation.name, `${cardId}/${lang}.name`);
      assertNonempty(translation.effect, `${cardId}/${lang}.effect`);
    }

    const attackNight = optionalAttack(review.attackNight, `${cardId}.attackNight`);
    const attackDay = optionalAttack(review.attackDay, `${cardId}.attackDay`);
    if ((attackNight === null) !== (attackDay === null))
      throw new Error(`${cardId}: attack values must both be set or empty`);

    return {
      id: cardId,
      name: review.nameJa,
      enNameOfficial: review.nameEnOfficial,
      enEffectOfficial: review.effectEnOfficial,
      pack: review.pack,
      song: review.song,
      illustrator: review.illustrator,
      rarity: review.rarity,
      element: review.element as CardDef['element'],
      type: review.type as CardDef['type'],
      clock: integer(review.clock, `${cardId}.clock`),
      attack: attackNight === null || attackDay === null ? null : { night: attackNight, day: attackDay },
      powerCost: integer(review.powerCost, `${cardId}.powerCost`),
      sendToPower: integer(review.sendToPower, `${cardId}.sendToPower`),
      effect: review.effectJa,
      image: release.imageUrl,
      errata: '',
      hasOfficialErrata: false,
      catalogStatus: release.catalogStatus as CardDef['catalogStatus'],
      distributionType: release.distributionType as CardDef['distributionType'],
      publicationStatus: 'published',
      playStatus: 'playable',
      playStatusReason: review.playStatusReason,
      sourceUrl: source.sourcePageUrl,
      sourceNote: REVIEWED_UNLISTED_SOURCE_NOTE,
      sourceSha256: source.sourceSha256,
      translations: release.translations,
      reviewedAt: review.reviewedAt,
    };
  });

  const canonical = JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    reviewedAt: manifest.reviewedAt,
    reviewStatus: manifest.reviewStatus,
    cards,
  });
  return {
    cards,
    sourceSha256: createHash('sha256').update(canonical).digest('hex'),
    reviewedAt: manifest.reviewedAt,
  };
}

export function loadReviewedUnlistedRelease(
  sourcesPath: string,
  reviewsPath: string,
  manifestPath: string,
): ReviewedUnlistedRelease {
  return buildReviewedUnlistedRelease(
    readJson<SourcesFile>(sourcesPath),
    readJson<HumanReviewsFile>(reviewsPath),
    readJson<ReviewedUnlistedReleaseManifest>(manifestPath),
  );
}
