import { describe, expect, it } from 'vitest';
import { cardTextsToRows } from '../public-card-dataset-preflight';

describe('public card dataset preflight', () => {
  it('normalizes only the four derived release languages', () => {
    expect(
      cardTextsToRows({
        card_1: {
          ja: { name: '公式', effect: '', reviewStatus: 'official' },
          'zh-TW': { name: '名稱', effect: '效果', reviewStatus: 'verified' },
          'zh-CN': { name: '名称', effect: '效果', reviewStatus: 'verified' },
          'zh-HK': { name: '名稱', effect: '效果', reviewStatus: 'verified' },
          ko: { name: '이름', effect: '효과', reviewStatus: 'verified' },
        },
      }),
    ).toEqual([
      { cardId: 'card_1', lang: 'zh-TW', nameText: '名稱', effectText: '效果', reviewStatus: 'verified' },
      { cardId: 'card_1', lang: 'zh-CN', nameText: '名称', effectText: '效果', reviewStatus: 'verified' },
      { cardId: 'card_1', lang: 'zh-HK', nameText: '名稱', effectText: '效果', reviewStatus: 'verified' },
      { cardId: 'card_1', lang: 'ko', nameText: '이름', effectText: '효과', reviewStatus: 'verified' },
    ]);
  });
});
