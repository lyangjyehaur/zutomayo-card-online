import { beforeEach, describe, expect, it } from 'vitest';
import type { CardDef } from '../../types';
import { getLocalizedCardEffect, getLocalizedCardName, initCardTextsI18n } from '../i18n';

const card: CardDef = {
  id: 'test_1',
  name: '公式日本語名',
  enNameOfficial: 'OFFICIAL ENGLISH NAME',
  pack: 'test',
  song: '',
  illustrator: '',
  rarity: 'N',
  element: '闇',
  type: 'Character',
  clock: 1,
  attack: { night: 10, day: 20 },
  powerCost: 0,
  sendToPower: 1,
  effect: '公式日本語効果',
  enEffectOfficial: 'OFFICIAL ENGLISH EFFECT',
  image: '',
  errata: '',
};

describe('localized card text policy', () => {
  beforeEach(() => initCardTextsI18n({}));

  it('uses official print text for Japanese and English', () => {
    expect(getLocalizedCardName(card, 'ja')).toBe('公式日本語名');
    expect(getLocalizedCardEffect(card, 'ja')).toBe('公式日本語効果');
    expect(getLocalizedCardName(card, 'en')).toBe('OFFICIAL ENGLISH NAME');
    expect(getLocalizedCardEffect(card, 'en')).toBe('OFFICIAL ENGLISH EFFECT');
  });

  it('uses only reviewed derived translations for other locales', () => {
    initCardTextsI18n({
      test_1: {
        'zh-TW': {
          name: '已複核卡名',
          effect: '已複核效果',
          nameSource: 'bilingual_review',
          effectSource: 'bilingual_review',
          reviewStatus: 'verified',
          reviewNote: '',
        },
      },
    });

    expect(getLocalizedCardName(card, 'zh-TW')).toBe('已複核卡名');
    expect(getLocalizedCardEffect(card, 'zh-TW')).toBe('已複核效果');
  });

  it('falls back to official English when a translation is pending review', () => {
    initCardTextsI18n({
      test_1: {
        ko: {
          name: '미검수 이름',
          effect: '미검수 효과',
          nameSource: 'legacy',
          effectSource: 'legacy',
          reviewStatus: 'pending_review',
          reviewNote: '',
        },
      },
    });

    expect(getLocalizedCardName(card, 'ko')).toBe('OFFICIAL ENGLISH NAME');
    expect(getLocalizedCardEffect(card, 'ko')).toBe('OFFICIAL ENGLISH EFFECT');
  });

  it('falls back from missing English print text to Japanese', () => {
    const japaneseOnly = { ...card, enNameOfficial: '', enEffectOfficial: '' };
    expect(getLocalizedCardName(japaneseOnly, 'zh-CN')).toBe('公式日本語名');
    expect(getLocalizedCardEffect(japaneseOnly, 'zh-CN')).toBe('公式日本語効果');
  });
});
