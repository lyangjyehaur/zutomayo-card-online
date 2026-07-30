import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { toHalfwidthAscii } from '../reviewTextNormalization';
import { applyUnlistedCardReview, detectReviewImageExtension } from '../unlisted-card-review-server';

const sourceCard = {
  candidateId: 'limited_001',
  expectedCardId: '',
  name: 'テストカード',
  pack: 'Fantasy Is Reality',
  catalogStatus: 'unlisted' as const,
  distributionType: 'bonus',
  sourcePageUrl: 'https://example.com/source',
  sourceImageUrl: 'https://example.com/image.jpg',
  localImagePath: 'data/vision-ocr/unlisted-cards/limited_001.jpg',
  sourceSha256: 'abc123',
};

describe('unlisted-card review service', () => {
  it('normalizes fullwidth ASCII characters in English review text', () => {
    expect(toHalfwidthAscii('（When played，gain ＋１０ HP！）　')).toBe('(When played,gain +10 HP!) ');
  });

  it('uses constrained selectors for card type and pack classification', () => {
    const reviewUi = readFileSync(resolve(process.cwd(), 'tools/unlisted-card-review/index.html'), 'utf8');

    expect(reviewUi).toContain('<select id="type" aria-required="true">');
    expect(reviewUi).toContain('<select id="pack" aria-required="${packless ? \'false\' : \'true\'}">');
    expect(reviewUi).not.toContain('<input id="pack"');
    expect(reviewUi).toContain('<option value="taxonomy">卡包／稀有度待更新</option>');
    expect(reviewUi).toContain('state.taxonomy.packlessCardIds.includes(review.cardId)');
    expect(reviewUi).toContain("[['', '不屬於任何卡包']]");
  });

  it('accepts the supported image formats by file signature', () => {
    expect(detectReviewImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('.jpg');
    expect(detectReviewImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('.png');
    expect(detectReviewImageExtension(Buffer.from('RIFF0000WEBP', 'ascii'))).toBe('.webp');
  });

  it('rejects files that are not supported card images', () => {
    expect(() => detectReviewImageExtension(Buffer.from('not an image'))).toThrow(
      'Only JPEG, PNG, and WebP card images are supported',
    );
  });

  it('prefills the known fourth-set SE printed number without dropping the denominator', () => {
    const review = applyUnlistedCardReview(
      {
        ...sourceCard,
        candidateId: '4th_105',
        expectedCardId: '4th_105',
        catalogStatus: 'pending_listing',
      },
      undefined,
      {},
    );

    expect(review).toMatchObject({
      cardId: '4th_105',
      printedNumber: '105/104',
      rarity: 'SE',
      type: 'Character',
      attackNight: '0',
      attackDay: '250',
    });
  });

  it('saves incomplete work as a local draft without approving the image', () => {
    const review = applyUnlistedCardReview(
      sourceCard,
      undefined,
      { cardId: 'bonus_001', nameEnOfficial: 'Test Card' },
      '2026-07-23T12:00:00.000Z',
    );

    expect(review).toMatchObject({
      cardId: 'bonus_001',
      nameJa: 'テストカード',
      nameEnOfficial: 'Test Card',
      imageReviewStatus: 'needs_review',
      textReviewStatus: 'draft',
      reviewedAt: '2026-07-23T12:00:00.000Z',
    });
  });

  it('removes the legacy promo prefix from submitted card IDs', () => {
    const review = applyUnlistedCardReview(sourceCard, undefined, { cardId: 'promo_bonus_001' });

    expect(review.cardId).toBe('bonus_001');
  });

  it('normalizes submitted English effect text before saving', () => {
    const review = applyUnlistedCardReview(sourceCard, undefined, {
      effectEnOfficial: 'Regain １０ HP（once per turn）！',
    });

    expect(review.effectEnOfficial).toBe('Regain 10 HP(once per turn)!');
  });

  it('normalizes submitted English card names before saving', () => {
    const review = applyUnlistedCardReview(sourceCard, undefined, {
      nameEnOfficial: 'UNIGURI（Local ver.）！',
    });

    expect(review.nameEnOfficial).toBe('UNIGURI(Local ver.)!');
  });

  it('keeps text verification and image approval as independent decisions', () => {
    const review = applyUnlistedCardReview(sourceCard, undefined, {
      cardId: 'bonus_001',
      printedNumber: 'PR-001',
      nameEnOfficial: 'Test Card',
      type: 'Enchant',
      rarity: 'N+',
      element: '風',
      clock: '2',
      powerCost: '1',
      sendToPower: '1',
      printedEffectStatus: 'none',
      playStatus: 'playable',
      imageReviewStatus: 'needs_better_image',
      textReviewStatus: 'verified',
    });

    expect(review.textReviewStatus).toBe('verified');
    expect(review.imageReviewStatus).toBe('needs_better_image');
  });

  it('requires complete printed metadata before verifying text', () => {
    expect(() =>
      applyUnlistedCardReview(sourceCard, undefined, {
        playStatus: 'playable',
        textReviewStatus: 'verified',
      }),
    ).toThrow('clock must be an integer');
  });

  it('requires both printed attack values for verified Character cards', () => {
    expect(() =>
      applyUnlistedCardReview(sourceCard, undefined, {
        cardId: 'bonus_001',
        printedNumber: 'PR-001',
        nameEnOfficial: 'Test Card',
        type: 'Character',
        rarity: 'N+',
        element: '風',
        clock: '2',
        powerCost: '1',
        sendToPower: '1',
        printedEffectStatus: 'none',
        playStatus: 'playable',
        textReviewStatus: 'verified',
      }),
    ).toThrow('night attack must be an integer');
  });

  it('requires both languages when a printed effect is present', () => {
    expect(() =>
      applyUnlistedCardReview(sourceCard, undefined, {
        cardId: 'bonus_001',
        printedNumber: 'PR-001',
        nameEnOfficial: 'Test Card',
        type: 'Enchant',
        rarity: 'N+',
        element: '風',
        clock: '2',
        powerCost: '1',
        sendToPower: '1',
        printedEffectStatus: 'present',
        playStatus: 'playable',
        effectJa: '効果テキスト',
        textReviewStatus: 'verified',
      }),
    ).toThrow('Japanese and official English effects are required');
  });

  it('rejects effect text when the reviewer marks the card as having no printed effect', () => {
    expect(() =>
      applyUnlistedCardReview(sourceCard, undefined, {
        cardId: 'bonus_001',
        printedNumber: 'PR-001',
        nameEnOfficial: 'Test Card',
        type: 'Enchant',
        rarity: 'N+',
        element: '風',
        clock: '2',
        powerCost: '1',
        sendToPower: '1',
        printedEffectStatus: 'none',
        playStatus: 'playable',
        effectJa: 'should not remain',
        textReviewStatus: 'verified',
      }),
    ).toThrow('Effect text must be empty');
  });

  it('requires a reason before verifying a display-only card', () => {
    expect(() =>
      applyUnlistedCardReview(sourceCard, undefined, {
        cardId: 'bonus_001',
        printedNumber: 'PR-001',
        nameEnOfficial: 'Test Card',
        type: 'Enchant',
        rarity: 'N+',
        element: '風',
        clock: '2',
        powerCost: '1',
        sendToPower: '1',
        printedEffectStatus: 'none',
        playStatus: 'display_only',
        textReviewStatus: 'verified',
      }),
    ).toThrow('play status reason is required');
  });

  it('allows verified display-only cards without gameplay-only metadata', () => {
    const review = applyUnlistedCardReview(sourceCard, undefined, {
      cardId: 'collaboration_007',
      printedNumber: '07/**',
      nameJa: '仲間のドクロ',
      nameEnOfficial: 'Nakamano Dokuro',
      type: 'Character',
      rarity: 'SR+',
      element: '',
      clock: '5',
      powerCost: '',
      sendToPower: '',
      attackNight: '2021',
      attackDay: '817',
      pack: '',
      printedEffectStatus: 'none',
      playStatus: 'display_only',
      playStatusReason: '沒有明確的屬性、Power Cost 等，無法加入遊戲',
      textReviewStatus: 'verified',
    });

    expect(review).toMatchObject({
      element: '',
      pack: '',
      powerCost: '',
      sendToPower: '',
      textReviewStatus: 'verified',
    });
  });

  it('rejects assigning a pack to the known packless card', () => {
    expect(() =>
      applyUnlistedCardReview(sourceCard, undefined, {
        cardId: 'collaboration_007',
        printedNumber: '07/**',
        nameJa: '仲間のドクロ',
        nameEnOfficial: 'Nakamano Dokuro',
        type: 'Character',
        rarity: 'SR+',
        element: '',
        clock: '5',
        powerCost: '',
        sendToPower: '',
        attackNight: '2021',
        attackDay: '817',
        pack: 'Fantasy Is Reality',
        printedEffectStatus: 'none',
        playStatus: 'display_only',
        playStatusReason: '沒有明確的屬性、Power Cost 等，無法加入遊戲',
        textReviewStatus: 'verified',
      }),
    ).toThrow('collaboration_007 must not have a pack');
  });

  it('still requires complete gameplay metadata for verified playable cards', () => {
    expect(() =>
      applyUnlistedCardReview(sourceCard, undefined, {
        cardId: 'bonus_001',
        printedNumber: '001/007',
        nameEnOfficial: 'Test Card',
        type: 'Enchant',
        rarity: 'SR',
        element: '',
        clock: '',
        powerCost: '',
        sendToPower: '',
        printedEffectStatus: 'none',
        playStatus: 'playable',
        textReviewStatus: 'verified',
      }),
    ).toThrow('clock must be an integer');
  });

  it('rejects distribution labels stored as packs when verifying text', () => {
    expect(() =>
      applyUnlistedCardReview(sourceCard, undefined, {
        cardId: 'bonus_001',
        printedNumber: '001/007',
        nameEnOfficial: 'Test Card',
        type: 'Enchant',
        rarity: 'R+',
        element: '風',
        clock: '2',
        powerCost: '1',
        sendToPower: '1',
        pack: '来場者カード',
        printedEffectStatus: 'none',
        playStatus: 'playable',
        textReviewStatus: 'verified',
      }),
    ).toThrow('Unsupported pack: 来場者カード');
  });

  it('accepts every supported plus rarity', () => {
    for (const rarity of ['N+', 'R+', 'SR+', 'UR+']) {
      const review = applyUnlistedCardReview(sourceCard, undefined, {
        cardId: 'bonus_001',
        printedNumber: '001/007',
        nameEnOfficial: 'Test Card',
        type: 'Enchant',
        rarity,
        element: '風',
        clock: '2',
        powerCost: '1',
        sendToPower: '1',
        printedEffectStatus: 'none',
        playStatus: 'playable',
        textReviewStatus: 'verified',
      });
      expect(review.rarity).toBe(rarity);
    }
  });
});
