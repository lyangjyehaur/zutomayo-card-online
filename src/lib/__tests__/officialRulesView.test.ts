import { describe, expect, it } from 'vitest';
import type { OfficialErrataItem, OfficialQaItem } from '../../api/client';
import { filterAndSortOfficialQa, filterOfficialErrata, officialErrataPacks } from '../officialRulesView';

function qaItem(number: number, publishedAt: string, tag: string, question: string): OfficialQaItem {
  return {
    id: `qa_${number}`,
    number,
    publishedAt,
    tagIds: [tag],
    tags: [tag],
    relatedCardIds: number === 2 ? ['1st_6'] : [],
    source: { question, answer: `answer ${number}` },
    localized: { question, answer: `answer ${number}` },
    requestedLocale: 'zh-TW',
    effectiveLocale: 'zh-TW',
    translationStatus: 'verified',
    sourceUrl: 'https://example.com',
    lastSyncedAt: '2026-07-21T00:00:00.000Z',
    contentVersion: 1,
  };
}

function errataItem(
  errataId: string,
  pack: string,
  options: { affectsName?: boolean; affectsEffect?: boolean } = {},
): OfficialErrataItem {
  return {
    errataId,
    cardId: `card_${errataId}`,
    cardName: `卡牌 ${errataId}`,
    cardNameJa: `カード ${errataId}`,
    pack,
    rarity: 'R',
    cardNumber: `${errataId}/104`,
    publishedAt: errataId === '002' ? '2026-04-04' : '2026-02-17',
    affectsName: options.affectsName ?? false,
    affectsEffect: options.affectsEffect ?? false,
    source: {
      incorrectText: '旧テキスト',
      correctedText: '新テキスト',
      reason: '',
      replacementPolicy: '',
      usagePolicy: '',
    },
    localized: {
      incorrectText: '舊文字',
      correctedText: `修正文字 ${errataId}`,
      reason: '',
      replacementPolicy: '',
      usagePolicy: '',
    },
    requestedLocale: 'zh-TW',
    effectiveLocale: 'zh-TW',
    translationStatus: 'verified',
    sourceUrl: 'https://example.com',
    lastSyncedAt: '2026-07-21T00:00:00.000Z',
    contentVersion: 1,
  };
}

describe('official rules views', () => {
  const qaItems = [qaItem(1, '2026-02-16', '基本ルール', '第一題'), qaItem(2, '2026-04-04', 'キャラクター', '第二題')];

  it('combines stable tag/card filters with localized full-text search', () => {
    expect(
      filterAndSortOfficialQa(qaItems, {
        query: '第二題',
        tag: 'キャラクター',
        cardId: '1st_6',
        locale: 'zh-TW',
        sort: 'official',
      }).map((item) => item.number),
    ).toEqual([2]);
  });

  it('supports official-number and latest-publication ordering', () => {
    expect(
      filterAndSortOfficialQa(qaItems, {
        query: '',
        tag: '',
        cardId: '',
        locale: 'zh-TW',
        sort: 'official',
      }).map((item) => item.number),
    ).toEqual([1, 2]);
    expect(
      filterAndSortOfficialQa(qaItems, {
        query: '',
        tag: '',
        cardId: '',
        locale: 'zh-TW',
        sort: 'latest',
      }).map((item) => item.number),
    ).toEqual([2, 1]);
  });

  it('filters errata by change scope, pack, and corrected text', () => {
    const items = [
      errataItem('001', 'PACK A', { affectsName: true }),
      errataItem('002', 'PACK B', { affectsEffect: true }),
    ];

    expect(officialErrataPacks(items)).toEqual(['PACK A', 'PACK B']);
    expect(
      filterOfficialErrata(items, {
        query: '修正文字 002',
        change: 'effect',
        pack: 'PACK B',
        locale: 'zh-TW',
      }).map((item) => item.errataId),
    ).toEqual(['002']);
  });
});
