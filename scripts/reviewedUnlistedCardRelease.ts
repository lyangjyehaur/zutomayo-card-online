import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEffect } from '../src/game/effects/parser';
import { rulesTerminologySourceViolations, rulesTerminologyViolations } from '../src/rulesTerminology';
import { CARD_DISTRIBUTION_TYPES, type CardDef } from '../src/game/types';

export const REVIEWED_UNLISTED_SOURCE_NOTE = 'reviewed-unlisted-release:v2';
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
  printedEffectStatus: string;
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
  candidateId: string;
  cardId: string;
  imageUrl: string;
  catalogStatus: string;
  distributionType: string;
  publicationStatus: string;
  playStatus: string;
  translations?: Partial<Record<ReviewedLang, ReleaseTranslation>>;
};

export type ReviewedUnlistedReleaseManifest = {
  schemaVersion: number;
  reviewedAt: string;
  reviewStatus: string;
  cards: ReleaseCard[];
};

export type ReviewedUnlistedCard = Omit<CardDef, 'element' | 'clock' | 'powerCost' | 'sendToPower' | 'attack'> & {
  element: CardDef['element'] | '';
  clock: number | null;
  powerCost: number | null;
  sendToPower: number | null;
  attack: { night: number; day: number } | null;
  sourceUrl: string;
  sourceNote: typeof REVIEWED_UNLISTED_SOURCE_NOTE;
  sourceSha256: string;
  translations: Partial<Record<ReviewedLang, ReleaseTranslation>>;
  reviewedAt: string;
};

export type ReviewedUnlistedRelease = {
  cards: ReviewedUnlistedCard[];
  sourceSha256: string;
  reviewedAt: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const HTTPS_R2 = /^https:\/\/r2\.dan\.tw\/cards\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.jpg$/;
const SUPPORTED_RELEASE_ACTIONS = new Set([
  'requestChoice',
  'clockAdvance',
  'moveOpponentAreaEnchant',
  'setOpponentElement',
  'boostAttack',
  'heal',
]);
const ELEMENTS = new Set(['闇', '炎', '電気', '風', 'カオス']);
const CARD_TYPES = new Set(['Character', 'Enchant', 'Area Enchant']);
const DISTRIBUTION_TYPES = new Set<string>(CARD_DISTRIBUTION_TYPES);
const CARD_TEXT_PROPER_NAMES: ReadonlyArray<{
  source: string;
  translations: Record<ReviewedLang, string>;
}> = [
  {
    source: 'うにぐり',
    translations: { 'zh-TW': '海膽栗子', 'zh-CN': '海胆栗子', 'zh-HK': '海膽栗子', ko: '우니구리' },
  },
  {
    source: 'にらちゃん',
    translations: { 'zh-TW': 'NIRA醬', 'zh-CN': 'NIRA酱', 'zh-HK': 'NIRA醬', ko: '니라짱' },
  },
  {
    source: '愛のペガサス',
    translations: { 'zh-TW': '愛之飛馬', 'zh-CN': '爱之飞马', 'zh-HK': '愛之飛馬', ko: '사랑의 페가수스' },
  },
  {
    source: 'スナネコ',
    translations: { 'zh-TW': '砂貓', 'zh-CN': '砂猫', 'zh-HK': '砂貓', ko: '스나네코' },
  },
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function integer(value: string, field: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${field} must be an integer >= ${minimum}`);
  return parsed;
}

function optionalInteger(value: string, field: string): number | null {
  if (value === '') return null;
  return integer(value, field);
}

function assertExactIds(label: string, ids: string[], expectedIds: string[]): void {
  const expected = [...expectedIds].sort();
  const actual = [...ids].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertNonempty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be nonempty`);
}

function cardTextProperNameViolations(
  lang: ReviewedLang,
  sourceText: string,
  translatedText: string,
  requireExactCount: boolean,
): string[] {
  const violations: string[] = [];
  for (const { source, translations } of CARD_TEXT_PROPER_NAMES) {
    const sourceCount = sourceText.split(source).length - 1;
    if (sourceCount === 0) continue;

    const translatedTerm = translations[lang];
    const translatedCount = translatedText.split(translatedTerm).length - 1;
    if ((requireExactCount && translatedCount !== sourceCount) || translatedCount < sourceCount) {
      violations.push(`${source} -> ${translatedTerm}`);
    }
  }
  return violations;
}

export function buildReviewedUnlistedRelease(
  sources: SourcesFile,
  reviews: HumanReviewsFile,
  manifest: ReviewedUnlistedReleaseManifest,
): ReviewedUnlistedRelease {
  if (manifest.schemaVersion !== 2) throw new Error('release manifest schemaVersion must be 2');
  if (manifest.reviewStatus !== 'verified') throw new Error('release manifest reviewStatus must be verified');
  if (!Number.isFinite(Date.parse(manifest.reviewedAt)))
    throw new Error('release manifest reviewedAt must be an ISO date');

  const relevantSources = sources.cards;
  const candidateIds = relevantSources.map((card) => card.candidateId);
  if (new Set(candidateIds).size !== candidateIds.length)
    throw new Error('source file contains duplicate candidate IDs');
  assertExactIds('human review file', Object.keys(reviews.reviews), candidateIds);
  assertExactIds(
    'release manifest',
    manifest.cards.map((card) => card.candidateId),
    candidateIds,
  );

  const sourceById = new Map(relevantSources.map((card) => [card.candidateId, card]));
  const releaseById = new Map(manifest.cards.map((card) => [card.candidateId, card]));
  const canonicalIds = manifest.cards.map((card) => card.cardId);
  if (new Set(canonicalIds).size !== canonicalIds.length)
    throw new Error('release manifest contains duplicate card IDs');

  const cards = candidateIds.map((candidateId): ReviewedUnlistedCard => {
    const source = sourceById.get(candidateId);
    const review = reviews.reviews[candidateId];
    const release = releaseById.get(candidateId);
    if (!source || !review || !release) throw new Error(`${candidateId}: incomplete reviewed release input`);
    const cardId = release.cardId;
    if (!cardId || review.cardId !== cardId || (source.expectedCardId && source.expectedCardId !== cardId)) {
      throw new Error(`${candidateId}: card IDs disagree`);
    }
    if (!SHA256.test(source.sourceSha256)) throw new Error(`${candidateId}: invalid source SHA-256`);
    if (!source.sourcePageUrl.startsWith('https://')) throw new Error(`${candidateId}: source page must use HTTPS`);
    if (!HTTPS_R2.test(release.imageUrl)) throw new Error(`${candidateId}: image must be a canonical R2 JPEG URL`);
    if (review.textReviewStatus !== 'verified' || review.imageReviewStatus !== 'approved') {
      throw new Error(`${candidateId}: text and image reviews must be approved`);
    }
    if (!['playable', 'display_only'].includes(review.playStatus) || release.playStatus !== review.playStatus) {
      throw new Error(`${candidateId}: release play status differs from the approved review`);
    }
    if (release.publicationStatus !== 'published') throw new Error(`${cardId}: release card must be published`);
    if (release.catalogStatus !== source.catalogStatus || release.distributionType !== source.distributionType) {
      throw new Error(`${cardId}: release catalog metadata differs from reviewed source`);
    }
    if (!DISTRIBUTION_TYPES.has(release.distributionType)) {
      throw new Error(`${cardId}: unsupported distribution type ${release.distributionType}`);
    }
    if (!CARD_TYPES.has(review.type)) throw new Error(`${cardId}: unsupported card type ${review.type}`);
    if (review.playStatus === 'playable' && !ELEMENTS.has(review.element)) {
      throw new Error(`${cardId}: playable card has unsupported element ${review.element}`);
    }
    if (review.element && !ELEMENTS.has(review.element))
      throw new Error(`${cardId}: unsupported element ${review.element}`);
    for (const field of ['nameJa', 'nameEnOfficial', 'rarity', 'pack'] as const) {
      assertNonempty(review[field], `${cardId}.${field}`);
    }
    if (review.printedEffectStatus === 'present') {
      assertNonempty(review.effectJa, `${cardId}.effectJa`);
      assertNonempty(review.effectEnOfficial, `${cardId}.effectEnOfficial`);
    } else if (review.printedEffectStatus !== 'none' || review.effectJa || review.effectEnOfficial) {
      throw new Error(`${cardId}: printed effect status and text disagree`);
    }
    if (review.playStatus === 'display_only') assertNonempty(review.playStatusReason, `${cardId}.playStatusReason`);
    if (!Number.isFinite(Date.parse(review.reviewedAt))) throw new Error(`${cardId}: invalid human review date`);

    if (review.playStatus === 'playable' && review.effectJa) {
      const parsed = parseEffect(review.effectJa);
      if (!parsed) throw new Error(`${cardId}: reviewed effect does not parse`);
      if (!SUPPORTED_RELEASE_ACTIONS.has(parsed.action.type)) {
        throw new Error(`${cardId}: parsed action ${parsed.action.type} has no approved release executor`);
      }
    }
    const translatedLangs = Object.keys(release.translations ?? {});
    if (translatedLangs.length !== REVIEWED_UNLISTED_LANGS.length) {
      throw new Error(`${cardId}: reviewed translations must be complete for every derived language`);
    }
    for (const lang of translatedLangs as ReviewedLang[]) {
      const translation = release.translations?.[lang];
      if (!translation || !REVIEWED_UNLISTED_LANGS.includes(lang)) {
        throw new Error(`${cardId}/${lang}: unsupported reviewed translation`);
      }
      assertNonempty(translation.name, `${cardId}/${lang}.name`);
      const cardNameViolations = cardTextProperNameViolations(lang, review.nameJa, translation.name, true);
      if (cardNameViolations.length > 0) {
        throw new Error(`${cardId}/${lang}: non-canonical card-name terminology (${cardNameViolations.join(', ')})`);
      }
      if (review.effectJa) assertNonempty(translation.effect, `${cardId}/${lang}.effect`);
      const effectProperNameViolations = cardTextProperNameViolations(lang, review.effectJa, translation.effect, false);
      if (effectProperNameViolations.length > 0) {
        throw new Error(
          `${cardId}/${lang}: non-canonical card-effect proper name (${effectProperNameViolations.join(', ')})`,
        );
      }
      const terminologyViolations = rulesTerminologyViolations(lang, translation.effect);
      if (terminologyViolations.length > 0) {
        throw new Error(`${cardId}/${lang}: non-canonical rules terminology (${terminologyViolations.join(', ')})`);
      }
      const missingCanonicalTerms = rulesTerminologySourceViolations('ja', lang, review.effectJa, translation.effect);
      if (missingCanonicalTerms.length > 0) {
        throw new Error(`${cardId}/${lang}: missing canonical rules terminology (${missingCanonicalTerms.join(', ')})`);
      }
    }

    const attackNight = optionalInteger(review.attackNight, `${cardId}.attackNight`);
    const attackDay = optionalInteger(review.attackDay, `${cardId}.attackDay`);
    if ((attackNight === null) !== (attackDay === null))
      throw new Error(`${cardId}: attack values must both be set or empty`);
    if (review.playStatus === 'playable' && review.type === 'Character' && attackNight === null) {
      throw new Error(`${cardId}: playable Character attack values are required`);
    }

    const clock = optionalInteger(review.clock, `${cardId}.clock`);
    const powerCost = optionalInteger(review.powerCost, `${cardId}.powerCost`);
    const sendToPower = optionalInteger(review.sendToPower, `${cardId}.sendToPower`);
    if (review.playStatus === 'playable' && [clock, powerCost, sendToPower].some((value) => value === null)) {
      throw new Error(`${cardId}: playable card gameplay values are required`);
    }

    return {
      id: cardId,
      name: review.nameJa,
      enNameOfficial: review.nameEnOfficial,
      enEffectOfficial: review.effectEnOfficial,
      pack: review.pack,
      song: review.song,
      illustrator: review.illustrator,
      rarity: review.rarity,
      element: review.element as CardDef['element'] | '',
      type: review.type as CardDef['type'],
      clock,
      attack: attackNight === null || attackDay === null ? null : { night: attackNight, day: attackDay },
      powerCost,
      sendToPower,
      effect: review.effectJa,
      image: release.imageUrl,
      errata: '',
      hasOfficialErrata: false,
      catalogStatus: release.catalogStatus as CardDef['catalogStatus'],
      distributionType: release.distributionType as CardDef['distributionType'],
      publicationStatus: 'published',
      playStatus: review.playStatus as CardDef['playStatus'],
      playStatusReason: review.playStatusReason,
      sourceUrl: source.sourcePageUrl,
      sourceNote: REVIEWED_UNLISTED_SOURCE_NOTE,
      sourceSha256: source.sourceSha256,
      translations: release.translations ?? {},
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
