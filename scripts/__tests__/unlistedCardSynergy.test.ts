import { describe, expect, it } from 'vitest';
import { toVerifiedUnlistedSynergyCard } from '../unlistedCardSynergy';

describe('unlisted card synergy input', () => {
  it('excludes a draft even when OCR supplied effect and metadata', () => {
    expect(
      toVerifiedUnlistedSynergyCard(
        'limited-001',
        {
          cardId: 'BONUS_001',
          nameJa: 'OCR カード名',
          effectJa: 'デッキの上からカードを３枚アビスに置く',
          element: '炎',
          type: 'Character',
          song: 'OCR 曲名',
        },
        {
          textReviewStatus: 'draft',
        },
      ),
    ).toBeNull();
  });

  it('includes a human-verified review as disabled by default', () => {
    expect(
      toVerifiedUnlistedSynergyCard(
        'limited-001',
        {
          cardId: 'BONUS_001',
          nameJa: 'OCR カード名',
          effectJa: 'HPを10回復する',
          element: '風',
          type: 'Enchant',
        },
        {
          textReviewStatus: 'verified',
          nameJa: '校對済みカード',
        },
      ),
    ).toEqual({
      id: 'BONUS_001',
      name: '校對済みカード',
      effect: 'HPを10回復する',
      element: '風',
      type: 'Enchant',
      playStatus: 'disabled',
      source: 'unlisted-review',
    });
  });

  it('never accepts a machine-suggestion verification flag without a verified human review', () => {
    expect(toVerifiedUnlistedSynergyCard('limited-001', { textReviewStatus: 'verified' }, undefined)).toBeNull();
    expect(
      toVerifiedUnlistedSynergyCard('limited-001', { textReviewStatus: 'verified' }, { textReviewStatus: 'draft' }),
    ).toBeNull();
  });
});
