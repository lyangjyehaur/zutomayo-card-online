import { describe, expect, it } from 'vitest';
import { cardTextsToRows, evaluatePublicCatalog, playableCardTextsToRows } from '../public-card-dataset-preflight';

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

  it('excludes display-only card texts from the playable translation gate', () => {
    expect(
      playableCardTextsToRows(
        {
          playable_1: {
            'zh-TW': { name: '可用卡', effect: '', reviewStatus: 'verified' },
          },
          display_1: {
            ja: { name: '展示カード', effect: '', reviewStatus: 'official' },
          },
        },
        ['playable_1'],
      ).map((row) => row.cardId),
    ).toEqual(['playable_1', 'playable_1', 'playable_1', 'playable_1']);
  });

  it('requires display-only cards to stay in the catalog and out of the battle pool', () => {
    const playableCards = Array.from({ length: 479 }, (_, index) => ({
      id: `playable_${index}`,
      playStatus: 'playable' as const,
    }));
    const displayOnlyCards = Array.from({ length: 7 }, (_, index) => ({
      id: `display_${index}`,
      playStatus: 'display_only' as const,
    }));

    const report = evaluatePublicCatalog(playableCards, [...playableCards, ...displayOnlyCards]);

    expect(report.failures).toEqual([]);
    expect(report.metrics).toEqual({ catalogCards: 486, displayOnlyCards: 7 });
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });
});
