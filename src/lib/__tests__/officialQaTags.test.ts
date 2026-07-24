import { describe, expect, it } from 'vitest';
import { officialQaItemMatchesTag, officialQaTagOptionIsSelected, officialQaTagOptions } from '../officialQaTags';

describe('official Q&A tag filters', () => {
  const traditionalChinese = {
    tagIds: ['基本ルール', 'キャラクター'],
    tags: ['基本規則', '角色'],
  };

  it('uses source tag IDs while displaying localized labels', () => {
    expect(officialQaTagOptions([traditionalChinese], 'zh-TW')).toEqual([
      { id: 'キャラクター', label: '角色' },
      { id: '基本ルール', label: '基本規則' },
    ]);
  });

  it('keeps a selected tag active after its display language changes', () => {
    const korean = { tagIds: ['基本ルール'], tags: ['기본 규칙'] };
    expect(officialQaItemMatchesTag(korean, '基本ルール')).toBe(true);
    expect(officialQaTagOptionIsSelected({ id: '基本ルール', label: '기본 규칙' }, '基本ルール')).toBe(true);
  });

  it('accepts legacy localized filter URLs in the current language', () => {
    expect(officialQaItemMatchesTag(traditionalChinese, '角色')).toBe(true);
    expect(officialQaTagOptionIsSelected({ id: 'キャラクター', label: '角色' }, '角色')).toBe(true);
  });
});
