import { describe, expect, it } from 'vitest';
import {
  buildReviewedUnlistedRelease,
  REVIEWED_UNLISTED_CARD_IDS,
  REVIEWED_UNLISTED_LANGS,
  REVIEWED_UNLISTED_SOURCE_NOTE,
  type ReviewedUnlistedReleaseManifest,
} from '../reviewedUnlistedCardRelease';

const sourceCards = REVIEWED_UNLISTED_CARD_IDS.map((cardId) => ({
  candidateId: cardId,
  expectedCardId: cardId,
  catalogStatus: 'pending_listing',
  distributionType: 'standard',
  sourcePageUrl: 'https://example.com/review',
  sourceSha256: 'a'.repeat(64),
}));

const effects = {
  '4th_105':
    'アビスのカードを8枚選び、裏向きにして混ぜ、デッキの底に置く。そうしない場合、ゲームに敗北する。お互いのパワーチャージャーのカードをすべてアビスに置く。',
  '4th_106': 'クロノスの時計を9つ進ませる',
  '4th_107': '相手のエリアエンチャントを、相手のアビスに置く',
} as const;

function inputs() {
  const reviews = Object.fromEntries(
    REVIEWED_UNLISTED_CARD_IDS.map((cardId) => [
      cardId,
      {
        cardId,
        nameJa: cardId,
        nameEnOfficial: cardId,
        effectJa: effects[cardId],
        effectEnOfficial: `Official ${cardId}`,
        playStatus: 'playable',
        playStatusReason: '',
        type: cardId === '4th_105' ? 'Character' : 'Enchant',
        rarity: 'SE',
        element: cardId === '4th_105' ? 'カオス' : cardId === '4th_106' ? '闇' : '風',
        clock: cardId === '4th_107' ? '2' : '0',
        powerCost: cardId === '4th_106' ? '2' : cardId === '4th_107' ? '1' : '0',
        sendToPower: cardId === '4th_107' ? '1' : '0',
        attackNight: cardId === '4th_105' ? '0' : '',
        attackDay: cardId === '4th_105' ? '250' : '',
        song: '',
        illustrator: 'reviewed illustrator',
        pack: 'Fantasy Is Reality',
        imageReviewStatus: 'approved',
        textReviewStatus: 'verified',
        reviewedAt: '2026-07-28T00:00:00.000Z',
      },
    ]),
  );
  const cards = REVIEWED_UNLISTED_CARD_IDS.map((cardId) => ({
    cardId,
    imageUrl: `https://r2.dan.tw/cards/fantasy-is-reality/zutomayocard_${cardId}.jpg`,
    catalogStatus: 'pending_listing',
    distributionType: 'standard',
    publicationStatus: 'published',
    playStatus: 'playable',
    translations: Object.fromEntries(
      REVIEWED_UNLISTED_LANGS.map((lang) => [lang, { name: `${cardId} ${lang}`, effect: `effect ${lang}` }]),
    ),
  }));
  return {
    sources: { cards: sourceCards },
    reviews: { reviews },
    manifest: {
      schemaVersion: 1,
      reviewedAt: '2026-07-28T00:00:00.000Z',
      reviewStatus: 'verified',
      cards,
    } as ReviewedUnlistedReleaseManifest,
  };
}

describe('reviewed unlisted card release', () => {
  it('builds the exact allowlisted release and preserves provenance', () => {
    const { sources, reviews, manifest } = inputs();
    const release = buildReviewedUnlistedRelease(sources, reviews, manifest);
    expect(release.cards.map((card) => card.id)).toEqual(REVIEWED_UNLISTED_CARD_IDS);
    expect(release.cards.every((card) => card.sourceNote === REVIEWED_UNLISTED_SOURCE_NOTE)).toBe(true);
    expect(release.cards[0]).toMatchObject({
      id: '4th_105',
      attack: { night: 0, day: 250 },
      publicationStatus: 'published',
      playStatus: 'playable',
    });
    expect(release.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when the manifest omits a required locale', () => {
    const { sources, reviews, manifest } = inputs();
    delete (manifest.cards[0].translations as Partial<(typeof manifest.cards)[0]['translations']>)['zh-HK'];
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow('missing reviewed translation');
  });

  it('fails closed when the reviewed source IDs are not the exact release allowlist', () => {
    const { sources, reviews, manifest } = inputs();
    manifest.cards[0].cardId = '4th_108';
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
    (unsupported.reviews.reviews['4th_106'] as { effectJa: string }).effectJa = '攻撃力+20';
    expect(() => buildReviewedUnlistedRelease(unsupported.sources, unsupported.reviews, unsupported.manifest)).toThrow(
      'has no approved release executor',
    );
  });
});
