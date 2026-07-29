import { describe, expect, it } from 'vitest';
import {
  buildReviewedUnlistedRelease,
  REVIEWED_UNLISTED_LANGS,
  REVIEWED_UNLISTED_SOURCE_NOTE,
  type ReviewedUnlistedReleaseManifest,
} from '../reviewedUnlistedCardRelease';

const candidates = [
  { candidateId: '4th_105', cardId: '4th_105', playStatus: 'playable' },
  { candidateId: 'limited_001', cardId: 'bonus_001', playStatus: 'playable' },
  { candidateId: 'limited_013', cardId: 'collaboration_007', playStatus: 'display_only' },
] as const;

const sourceCards = candidates.map(({ candidateId, cardId }) => ({
  candidateId,
  expectedCardId: candidateId === cardId ? cardId : '',
  catalogStatus: candidateId.startsWith('4th_') ? 'pending_listing' : 'unlisted',
  distributionType: candidateId.startsWith('4th_') ? 'standard' : 'collaboration',
  sourcePageUrl: 'https://example.com/review',
  sourceSha256: 'a'.repeat(64),
}));

function completeTranslations(cardId: string) {
  return Object.fromEntries(
    REVIEWED_UNLISTED_LANGS.map((lang) => [lang, { name: `${cardId} ${lang}`, effect: `effect ${lang}` }]),
  );
}

function inputs() {
  const reviews = {
    '4th_105': {
      cardId: '4th_105',
      nameJa: 'CHIRITORI-OTOKO DA!!',
      nameEnOfficial: 'CHIRITORI-OTOKO DA!!',
      effectJa:
        'アビスのカードを8枚選び、裏向きにして混ぜ、デッキの底に置く。そうしない場合、ゲームに敗北する。お互いのパワーチャージャーのカードをすべてアビスに置く。',
      effectEnOfficial: 'Official effect',
      printedEffectStatus: 'present',
      playStatus: 'playable',
      playStatusReason: '',
      type: 'Character',
      rarity: 'SE',
      element: 'カオス',
      clock: '0',
      powerCost: '0',
      sendToPower: '0',
      attackNight: '0',
      attackDay: '250',
      song: '',
      illustrator: 'reviewed illustrator',
      pack: 'Fantasy Is Reality',
      imageReviewStatus: 'approved',
      textReviewStatus: 'verified',
      reviewedAt: '2026-07-30T00:00:00.000Z',
    },
    limited_001: {
      cardId: 'bonus_001',
      nameJa: '正しい偽りからの起床',
      nameEnOfficial: 'Tadashii Itsuwarikara no Kishou',
      effectJa: '相手のキャラクターカードの属性をバトルフィールドにいる間闇にする',
      effectEnOfficial: "The attribute of your opponent's character card changes to darkness.",
      printedEffectStatus: 'present',
      playStatus: 'playable',
      playStatusReason: '',
      type: 'Enchant',
      rarity: 'SR',
      element: '電気',
      clock: '0',
      powerCost: '3',
      sendToPower: '1',
      attackNight: '',
      attackDay: '',
      song: '',
      illustrator: 'reviewed illustrator',
      pack: 'Bonus',
      imageReviewStatus: 'approved',
      textReviewStatus: 'verified',
      reviewedAt: '2026-07-30T00:00:00.000Z',
    },
    limited_013: {
      cardId: 'collaboration_007',
      nameJa: '仲間のドクロ',
      nameEnOfficial: 'Nakamano Dokuro',
      effectJa: '',
      effectEnOfficial: '',
      printedEffectStatus: 'none',
      playStatus: 'display_only',
      playStatusReason: 'No printed element or Power Cost',
      type: 'Character',
      rarity: 'SR',
      element: '',
      clock: '5',
      powerCost: '',
      sendToPower: '',
      attackNight: '2021',
      attackDay: '817',
      song: '',
      illustrator: 'Yosuke Torii',
      pack: 'Collaboration',
      imageReviewStatus: 'approved',
      textReviewStatus: 'verified',
      reviewedAt: '2026-07-30T00:00:00.000Z',
    },
  };
  const cards = candidates.map(({ candidateId, cardId, playStatus }) => ({
    candidateId,
    cardId,
    imageUrl: `https://r2.dan.tw/cards/reviewed-unlisted/zutomayocard_${cardId}.jpg`,
    catalogStatus: candidateId.startsWith('4th_') ? 'pending_listing' : 'unlisted',
    distributionType: candidateId.startsWith('4th_') ? 'standard' : 'collaboration',
    publicationStatus: 'published',
    playStatus,
    translations: completeTranslations(cardId),
  }));
  return {
    sources: { cards: sourceCards },
    reviews: { reviews },
    manifest: {
      schemaVersion: 2,
      reviewedAt: '2026-07-30T00:00:00.000Z',
      reviewStatus: 'verified',
      cards,
    } as ReviewedUnlistedReleaseManifest,
  };
}

describe('reviewed unlisted card release', () => {
  it('builds mixed playable and display-only releases without inventing metadata', () => {
    const { sources, reviews, manifest } = inputs();
    const release = buildReviewedUnlistedRelease(sources, reviews, manifest);
    expect(release.cards.map((card) => card.id)).toEqual(candidates.map((card) => card.cardId));
    expect(release.cards.every((card) => card.sourceNote === REVIEWED_UNLISTED_SOURCE_NOTE)).toBe(true);
    expect(release.cards[0]).toMatchObject({ attack: { night: 0, day: 250 }, playStatus: 'playable' });
    expect(release.cards[1].translations).toEqual(manifest.cards[1].translations);
    expect(release.cards[2]).toMatchObject({
      id: 'collaboration_007',
      element: '',
      powerCost: null,
      sendToPower: null,
      playStatus: 'display_only',
    });
    expect(release.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a partial set of reviewed translations', () => {
    const { sources, reviews, manifest } = inputs();
    delete (manifest.cards[0].translations as Record<string, unknown>)['zh-HK'];
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'reviewed translations must be complete',
    );
  });

  it('rejects a published card without derived translations', () => {
    const { sources, reviews, manifest } = inputs();
    delete manifest.cards[2].translations;
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'reviewed translations must be complete',
    );
  });

  it('rejects non-canonical terminology in reviewed effects', () => {
    const { sources, reviews, manifest } = inputs();
    const translation = manifest.cards[0].translations?.['zh-TW'];
    if (!translation) throw new Error('test fixture translation missing');
    translation.effect = '將克洛諾斯推進8格';
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'non-canonical rules terminology (克洛諾斯 -> Chronos)',
    );
  });

  it('fails closed when the manifest omits a reviewed candidate', () => {
    const { sources, reviews, manifest } = inputs();
    manifest.cards.pop();
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'release manifest must contain exactly',
    );
  });

  it('rejects unreviewed images and effects without an approved executor', () => {
    const unapproved = inputs();
    unapproved.reviews.reviews['4th_105'].imageReviewStatus = 'pending';
    expect(() => buildReviewedUnlistedRelease(unapproved.sources, unapproved.reviews, unapproved.manifest)).toThrow(
      'text and image reviews must be approved',
    );

    const unsupported = inputs();
    unsupported.reviews.reviews.limited_001.effectJa = '未対応の効果';
    expect(() => buildReviewedUnlistedRelease(unsupported.sources, unsupported.reviews, unsupported.manifest)).toThrow(
      'reviewed effect does not parse',
    );
  });

  it('keeps playable element and gameplay values mandatory', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.element = '';
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'playable card has unsupported element',
    );
  });

  it('requires reviewed rarity for every released card', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_013.rarity = '';
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'collaboration_007.rarity must be nonempty',
    );
  });

  it('allows a playable card with no printed effect and empty reviewed effect translations', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.effectJa = '';
    reviews.reviews.limited_001.effectEnOfficial = '';
    reviews.reviews.limited_001.printedEffectStatus = 'none';
    manifest.cards[1].translations = completeTranslations('bonus_001');
    for (const translation of Object.values(manifest.cards[1].translations)) translation.effect = '';

    const release = buildReviewedUnlistedRelease(sources, reviews, manifest);

    expect(release.cards[1]).toMatchObject({
      id: 'bonus_001',
      effect: '',
      translations: manifest.cards[1].translations,
    });
  });
});
