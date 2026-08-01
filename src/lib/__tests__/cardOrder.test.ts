import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { compareCardIds, compareCardsById, sortCardsById } from '../cardOrder';

const require = createRequire(import.meta.url);
const backendCardOrder = require('../../../api/cardOrder.cjs') as {
  compareCardIds: typeof compareCardIds;
  compareCardsById: typeof compareCardsById;
  sortCardsById: typeof sortCardsById;
};

describe('card number ordering', () => {
  it('orders card numbers naturally instead of lexicographically', () => {
    const ids = ['4th_105', '4th_11', '4th_100', '4th_2', '4th_99', '4th_10', '4th_9', '4th_1'];

    expect(ids.sort(compareCardIds)).toEqual([
      '4th_1',
      '4th_2',
      '4th_9',
      '4th_10',
      '4th_11',
      '4th_99',
      '4th_100',
      '4th_105',
    ]);
  });

  it('uses the same immutable ordering helper for card collections', () => {
    const cards = [{ id: '2nd_10' }, { id: '1st_2' }, { id: '2nd_2' }, { id: '1st_10' }];

    expect(sortCardsById(cards).map((card) => card.id)).toEqual(['1st_2', '1st_10', '2nd_2', '2nd_10']);
    expect(cards.map((card) => card.id)).toEqual(['2nd_10', '1st_2', '2nd_2', '1st_10']);
  });

  it('has a deterministic fallback when numeric comparison treats IDs as equal', () => {
    expect(compareCardIds('4th_01', '4th_1')).toBeLessThan(0);
    expect(compareCardIds('4th_1', '4th_1')).toBe(0);
    expect(compareCardsById({ id: '4th_10' }, { id: '4th_2' })).toBeGreaterThan(0);
  });

  it('stays aligned with the backend ordering implementation', () => {
    const idCases = [
      ['4th_105', '4th_11', '4th_100', '4th_2', '4th_99', '4th_10', '4th_9', '4th_1'],
      ['promo_10', 'promo_2', '4th_01', '4th_1', '', 'SE_3'],
    ];

    for (const ids of idCases) {
      expect([...ids].sort(compareCardIds)).toEqual([...ids].sort(backendCardOrder.compareCardIds));
    }

    const cards = idCases.flat().map((id) => ({ id }));
    expect(sortCardsById(cards)).toEqual(backendCardOrder.sortCardsById(cards));
    expect([...cards].sort(compareCardsById)).toEqual([...cards].sort(backendCardOrder.compareCardsById));
  });
});
