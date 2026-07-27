import { describe, expect, it } from 'vitest';
import { applySynergyReview, relationKey, reviewDisplayProfile } from '../card-synergy-review-server';

const relation = {
  sourceCardId: '1st_1',
  targetCardId: '2nd_2',
  kind: 'enables' as const,
  rationale: 'Machine-generated rationale.',
};

describe('card synergy review service', () => {
  it('uses a stable directional relation key', () => {
    expect(relationKey(relation)).toBe('enables:1st_1:2nd_2');
  });

  it('preserves the candidate rationale when approving', () => {
    expect(applySynergyReview(relation, { status: 'approved' }, '2026-07-23T12:00:00.000Z')).toEqual({
      status: 'approved',
      rationale: 'Machine-generated rationale.',
      notes: '',
      reviewedAt: '2026-07-23T12:00:00.000Z',
    });
  });

  it('requires a reason when rejecting a candidate', () => {
    expect(() => applySynergyReview(relation, { status: 'rejected' })).toThrow('require review notes');
  });

  it('uses the reviewed localized name as primary review text and labels the Japanese source separately', () => {
    expect(
      reviewDisplayProfile(
        { cardId: '1st_1', cardName: 'にらちゃん', cardEffect: '日本語効果' },
        'NIRA 醬',
        '中文效果',
      ),
    ).toMatchObject({
      cardName: 'NIRA 醬',
      cardNameJa: 'にらちゃん',
      cardNameLocale: 'zh-TW',
      cardEffect: '中文效果',
      cardEffectJa: '日本語効果',
    });
  });

  it('does not silently mix an unreviewed Japanese name into the primary label', () => {
    expect(reviewDisplayProfile({ cardId: 'promo_1', cardName: '限定カード' })).toMatchObject({
      cardName: 'promo_1（尚無校對中文名）',
      cardNameJa: '限定カード',
      cardNameLocale: 'missing',
    });
  });
});
