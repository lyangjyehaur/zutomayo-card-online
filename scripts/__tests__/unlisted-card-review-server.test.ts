import { describe, expect, it } from 'vitest';

import { applyUnlistedCardReview, detectReviewImageExtension } from '../unlisted-card-review-server';

const sourceCard = {
  candidateId: 'limited_001',
  expectedCardId: '',
  name: 'テストカード',
  pack: '限定カード',
  catalogStatus: 'unlisted' as const,
  distributionType: 'bonus',
  sourcePageUrl: 'https://example.com/source',
  sourceImageUrl: 'https://example.com/image.jpg',
  localImagePath: 'data/vision-ocr/unlisted-cards/limited_001.jpg',
  sourceSha256: 'abc123',
};

describe('unlisted-card review service', () => {
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
      { cardId: 'promo_001', nameEnOfficial: 'Test Card' },
      '2026-07-23T12:00:00.000Z',
    );

    expect(review).toMatchObject({
      cardId: 'promo_001',
      nameJa: 'テストカード',
      nameEnOfficial: 'Test Card',
      imageReviewStatus: 'needs_review',
      textReviewStatus: 'draft',
      reviewedAt: '2026-07-23T12:00:00.000Z',
    });
  });

  it('keeps text verification and image approval as independent decisions', () => {
    const review = applyUnlistedCardReview(sourceCard, undefined, {
      cardId: 'promo_001',
      printedNumber: 'PR-001',
      nameEnOfficial: 'Test Card',
      type: 'Enchant',
      rarity: 'PR',
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
        textReviewStatus: 'verified',
      }),
    ).toThrow('clock must be an integer');
  });

  it('requires both printed attack values for verified Character cards', () => {
    expect(() =>
      applyUnlistedCardReview(sourceCard, undefined, {
        cardId: 'promo_001',
        printedNumber: 'PR-001',
        nameEnOfficial: 'Test Card',
        type: 'Character',
        rarity: 'PR',
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
        cardId: 'promo_001',
        printedNumber: 'PR-001',
        nameEnOfficial: 'Test Card',
        type: 'Enchant',
        rarity: 'PR',
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
        cardId: 'promo_001',
        printedNumber: 'PR-001',
        nameEnOfficial: 'Test Card',
        type: 'Enchant',
        rarity: 'PR',
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
        cardId: 'promo_001',
        printedNumber: 'PR-001',
        nameEnOfficial: 'Test Card',
        type: 'Enchant',
        rarity: 'PR',
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
});
